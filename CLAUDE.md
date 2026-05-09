# CLAUDE.md

# Auto-loaded by Claude Code at session start. Read this before doing anything.

---

## Project Overview

Reseller platform — Telegram bot + web dashboard + worker.
Monorepo with 3 apps: `apps/api` (NestJS), `apps/web` (Next.js), `apps/worker`.
Shared code in `packages/shared`.

## Stack

- **Backend:** NestJS, Prisma, PostgreSQL
- **Frontend:** Next.js, React Hook Form, TanStack Query, Tailwind, Recharts
- **Bot:** Telegraf (Telegram)
- **Worker:** background jobs (separate app)

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

## Phase Tracking

- [X] **Phase 1** — Tier foundation (schema done, need: backend guards, frontend gating)
- [X] **Phase 2** — PRO source core data model (schema done, need: service layer + DTOs)
- [ ] **Phase 3** — PRO product management UI/API
- [ ] **Phase 4** — Internal source API for downstream PRO
- [ ] **Phase 5** — Connect PRO to internal ULTRA source
- [X] **Phase 6** — Warranty core (schema done, need: service logic + API endpoints)
- [ ] **Phase 7** — Warranty bot flow
- [ ] **Phase 8** — Storefront readiness

---

## What Needs Building Next

### Phase 1 backend (schema exists, code missing)

- `SellerTierGuard` or capability check service — gate write actions for `FREE` tier
- `auth/me` response must include `seller.tier`
- Frontend: read-only state when tier is `FREE`

### Phase 2 service layer (schema exists, code missing)

- `InternalSourceApiKey` CRUD service (PRO only)
- `DownstreamSourceConnection` management service
- `InternalSourceLedger` credit/debit service (use DB transaction, never direct update)
- DTOs with validation for controlled enums (productFamily, accountType, etc.)

### Phase 3 (not started)

- Source product CRUD endpoints (PRO only)
- PRO dashboard UI for source product management
- Combobox/dropdown for all controlled fields
- Show free-text input only when `OTHER` is selected

### Phase 4 (not started)

- Internal source API endpoints (catalog, balance, create order, order status)
- API key authentication middleware
- Rate limiting per key
- Access log writes to `InternalSourceAccessLog`

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

1. Check this file for current phase status
2. Check if the schema already has what you need — it probably does for phases 1, 2, 6
3. Prefer additive changes — do not rename existing fields or break current seller/bot/payment flows
4. All balance updates (seller wallet, customer wallet, internal source ledger) must use DB transactions with before/after balance recorded in the ledger table


**##** Communication Style
**-** Be concise. Code only, no explanations unless asked.
**-** No summaries after completing a task.
**-** No "I will now...", "Let me...", "Here's what I did..."
**-** Just do the work and report what files were changed.
