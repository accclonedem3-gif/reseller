# CLAUDE.md

# Auto-loaded by Claude Code at session start. Read this before doing anything.

---

## Project Overview

Reseller platform — Telegram bot + web dashboard + worker.
Monorepo with 3 apps: `apps/api` (NestJS), `apps/web` (Vite + React), `apps/worker`.
Shared code in `packages/shared`.

## Stack

- **Backend:** NestJS, Prisma, PostgreSQL
- **Frontend:** Vite + React, React Hook Form, TanStack Query, Tailwind, Recharts
- **Bot:** Custom Telegram dispatcher in `apps/api/src/lib/telegram-bot.service.v2.ts` (no Telegraf)
- **Worker:** BullMQ background jobs (separate app)

---

## Current Schema Status (as of latest prisma/schema.prisma)

### ✅ Already in schema — do NOT re-add or re-migrate these

**Tier system (Phase 1 — DONE in schema)**

- `SellerTier` enum: `FREE`, `PRO`, `ULTRA`
- `Seller.tier` field with `@default(PRO)`

**Internal source infrastructure (Phase 2 — DONE in schema)**

- `InternalSourceApiKey` — ULTRA issues keys to PRO
- `DownstreamSourceConnection` — tracks upstream/downstream relationships + balance
- `InternalSourceLedger` — balance ledger per connection
- `InternalSourceOrder` + `InternalSourceOrderEvent` — source-level orders
- `InternalSourceAccessLog` — audit trail for API key usage
- `ProviderConfig.internalSourceConnectionId` — links shop to internal source

**Source product metadata (Phase 2 — DONE in schema)**

- Enums: `SourceProductFamily`, `SourceAccountType`, `SourceDurationType`, `SourceDeliveryMode`, `SourceWarrantyPolicy`
- `SourceProduct` extended with: `productFamily`, `productFamilyOther`, `accountType`, `accountTypeOther`, `durationType`, `durationTypeOther`, `sourceDeliveryMode`, `warrantyPolicy`, `internalSourceEnabled`, `internalSourcePrice`

**Warranty core (Phase 6 — DONE in schema)**

- `WarrantyClaim` model with full status enum: `PENDING`, `AUTO_RESOLVED`, `PENDING_STOCK`, `PENDING_REVIEW`, `PENDING_MANUAL`, `REJECTED`, `RESOLVED_MANUAL`
- `Order` warranty snapshot fields: `warrantyPolicySnapshot`, `warrantyDeliveryModeSnapshot`, `warrantyStartedAt`, `warrantyExpiresAt`, `warrantyClaimCount`
- `Order.sourceProviderKindSnapshot` — tracks if order used INTERNAL or EXTERNAL source
- `Order.internalSourceOrderId` + `Order.internalSourceOrderCode` — links to internal source order

**Provider model**

- `ProviderKind` enum: `EXTERNAL`, `INTERNAL`
- `ProviderConfig.providerKind` — distinguishes external (canboso) vs internal PRO source

---

## Phase Tracking — ALL DONE

- [X] **Phase 1** — Tier foundation (guards + `auth/me` + frontend gating)
- [X] **Phase 2** — PRO source core data model (service layer + DTOs)
- [X] **Phase 3** — PRO product management (API + UI page `source-products-page-pro.tsx`)
- [X] **Phase 4** — Internal source public API (`/internal-source/v1/*` + auth middleware + rate limit 60/min)
- [X] **Phase 5** — Connect PRO ↔ ULTRA (`SellerSourceConnectionService` + bot topup flow)
- [X] **Phase 6** — Warranty core (full route logic in `WarrantyService`)
- [X] **Phase 7** — Warranty bot UI (account selection, pending sessions in Redis)

---

## Known Tech Debt — Fix when touching these areas

### 🔥 High priority

- **`apps/worker/src/main.ts` has `// @ts-nocheck` at line 1** + file is pre-transpiled JS committed as TS source. 3200 lines of business-critical code (queue, scheduler, payment auto-detect, wallet debit) have NO type check. Refactor into typed modules incrementally — do NOT mass-rewrite (see lessons in `[[gemini-refactor-failure]]`).
- **Hardcoded USDT/VND = 27000** at 3 locations: `apps/worker/src/main.ts:1091`, `apps/api/src/orders/orders.service.ts:237` and `:1027`. Diverges from dynamic `paymentConfig.usdtVndRateOverride` used in bot display. Centralize into one helper.

### ⚠️ Medium

- **Fire-and-forget audit ledger** at `apps/api/src/customer-wallet/customer-wallet.service.ts:311` — `prisma.internalSourceLedger.create(...).catch(...)` lacks `await`. Audit row may not flush before request returns.
- **`pollWeb2mShops` dead code with decrypt bug** at `apps/worker/src/main.ts:2395` — uses `ENCRYPTION_KEY` env var (should be `APP_ENCRYPTION_KEY`). Currently unused (bootstrap doesn't call it) — remove or fix.
- **API key hashing inconsistency**: `InternalSourceApiKeyService.issueKey` uses bcrypt; `internal-source.service.ts:148` `createApiKey` uses sha256. `resolveApiKey` handles both, but `validateKey` (used in middleware) only handles bcrypt. Unify.

### ℹ️ Low

- Dead service: `apps/api/src/storefront/storefront.service.ts` — 3 methods throw "TODO Phase 8+", not wired into `app.module.ts`. Storefront scope is dropped; safe to delete.
- Fallback `"change-me-32-byte-key"` for `APP_ENCRYPTION_KEY` exists across worker files. Production validator catches it, but dev mode silently uses mock key.
- Routing-by-string in `wallet.service.ts:201-251` — `note.startsWith("UPGRADE_TIER:" / "TIER_SUB:")`. Fragile when adding new prefixes.

---

## Important Business Rules — Never Break These

### Tier rules

- `FREE` → read-only, cannot create shop/bot/payment/source features
- `PRO` → current seller behavior, can connect to external OR internal source
- `ULTRA` → superset of PRO, can also issue API keys and act as source provider (admin-assigned only)
- **Do NOT use `UserRole` for tier logic** — tier lives on `Seller.tier`
- `UserRole` stays as system permission only: `SUPER_ADMIN`, `SELLER`

### Warranty rules

- All warranty logic operates on `orderCode` / `Order` record, never on payment transaction
- When order is DELIVERED: snapshot `warrantyPolicySnapshot`, `warrantyStartedAt`, `warrantyExpiresAt` onto the order
- `warrantyClaimCount` on Order is a denormalized counter — always increment inside a DB transaction alongside inserting the `WarrantyClaim` record
- Auto orders: claim count ≤ 2 → auto resolve if stock exists; > 2 → PENDING_REVIEW + notify owner
- Manual orders: create PENDING_MANUAL claim, return `supportTelegram`/`supportZalo` to customer, notify owner

### Source order rules

- `Order.sourceProviderKindSnapshot` records whether fulfillment used EXTERNAL or INTERNAL at time of purchase
- Internal source orders flow through `InternalSourceOrder` then link back to `Order` via `internalSourceOrderId`
- Balance debit on `DownstreamSourceConnection` must use ledger pattern (never direct balance update)

---

## Key Model Relationships (quick reference)

```
User (1) ──── (1) Seller
Seller (1) ──── (*) Shop
Shop (1) ──── (1) BotConfig
Shop (1) ──── (1) ProviderConfig  ←── optionally links to DownstreamSourceConnection
Shop (1) ──── (1) PaymentConfig
Shop (1) ──── (*) SourceProduct
Seller/Shop (PRO) ──── (*) InternalSourceApiKey
InternalSourceApiKey (1) ──── (1) DownstreamSourceConnection
DownstreamSourceConnection (1) ──── (*) InternalSourceOrder
DownstreamSourceConnection (1) ──── (*) InternalSourceLedger
Order (1) ──── (*) WarrantyClaim
Order (1) ──── (1?) InternalSourceOrder
```

---

## Conventions in This Codebase

- All DB timestamps: `createdAt`, `updatedAt` mapped to `created_at`, `updated_at`
- Encrypted fields: suffix `Encrypted` (e.g. `telegramBotTokenEncrypted`)
- Snapshot fields: suffix `Snapshot` (e.g. `productNameSnapshot`, `warrantyPolicySnapshot`)
- Raw payloads stored as `Json` with suffix `Json` (e.g. `rawPayloadJson`, `metadataJson`)
- Prisma table names: snake_case via `@@map()`
- IDs: `cuid()`

---

## Before Writing Any Code

1. All 7 phases are DONE — the system is production-running. Treat changes as maintenance/feature additions on top of a live codebase, not greenfield.
2. Check schema first — it's mature, almost certainly has the fields you need; do NOT add new fields/migrations without reading `prisma/schema.prisma` first.
3. Prefer additive changes — do not rename existing fields or break current seller/bot/payment flows.
4. All balance updates (seller wallet, customer wallet, internal source ledger) must use DB transactions with before/after balance recorded in the ledger table.
5. Never mass-rewrite `apps/worker/src/main.ts` — it has `@ts-nocheck` AND 3200 lines of live business logic. Refactor incrementally with type-checked modules, build between each step. (A previous AI agent "refactored" by deleting 95% of the logic and pretending to keep it — see Known Tech Debt above.)


**##** Communication Style
**-** Be concise. Code only, no explanations unless asked.
**-** No summaries after completing a task.
**-** No "I will now...", "Let me...", "Here's what I did..."
**-** Just do the work and report what files were changed.
