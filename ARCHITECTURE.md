# Architecture

## Overview

Reseller platform — sellers run Telegram bots that sell digital accounts. Sellers can source
products from a built-in catalog (external provider) or from another seller's PRO-tier shop
(internal source). A web storefront layer is being added in later phases.

Monorepo layout:

```
apps/api      NestJS REST API + webhook handler + bot handler
apps/web      Next.js seller dashboard (management UI)
apps/worker   Background job processor (order fulfillment, queue drain)
packages/shared   Shared types, utilities, and provider adapters
prisma/       Single schema, single PostgreSQL database
```

---

## 3-Tier Seller Model

```
FREE  ──────  read-only dashboard, no shop/bot/payment/source features
PLUS  ──────  full bot + shop, can connect to external OR internal source
PRO   ──────  superset of PLUS, can also issue API keys and act as upstream source
```

Tier lives on `Seller.tier` (enum: `FREE`, `PLUS`, `PRO`).
`UserRole` (`SUPER_ADMIN`, `SELLER`) is for system permissions only — never used for tier logic.

Capability gates (`SellerCapabilityService`):

| Capability             | FREE | PLUS | PRO |
|------------------------|------|------|-----|
| `shop_manage`          | ✗    | ✓    | ✓   |
| `bot_manage`           | ✗    | ✓    | ✓   |
| `payment_manage`       | ✗    | ✓    | ✓   |
| `source_internal_use`  | ✗    | ✓    | ✓   |
| `source_internal_manage` | ✗  | ✗    | ✓   |
| `source_key_manage`    | ✗    | ✗    | ✓   |
| `warranty_manage`      | ✗    | ✓    | ✓   |

---

## Internal Source Flow

A PRO seller issues API keys to PLUS sellers so they can buy from PRO's catalog directly,
bypassing external providers.

```
PRO Seller
  │
  ├─ InternalSourceApiKey  (bcrypt-hashed, prefix: isk_…)
  │     issued to one downstream shop at a time
  │
  └─ SourceProduct (internalSourceEnabled=true, internalSourcePrice)
        PRO manages their catalog via /pro/source-products

PLUS Seller (downstream)
  │
  ├─ POST /seller/source-connection { apiKey: "isk_…" }
  │     → validates key (bcrypt), checks upstream PRO tier
  │     → creates DownstreamSourceConnection
  │     → upserts ProviderConfig { providerKind: INTERNAL, buyerKeyEncrypted }
  │
  ├─ POST /seller/source-connection/sync-catalog
  │     → reads upstream SourceProduct records directly from DB
  │     → calls applyCatalogProductsForShop()
  │     → downstream shop now has mirrored product list
  │
  └─ Customer places order via Telegram bot
        │
        ├─ Worker picks up job → purchaseFromProvider()
        │     → HTTP POST /api/v1/internal-source/v1/orders  (internal source API)
        │     → InternalSourceAuthMiddleware validates isk_ key (bcrypt)
        │     → rate-limited: 60 req/min per key
        │
        └─ InternalSourceApiController.createOrder()
              │
              ├─ SELECT FOR UPDATE on DownstreamSourceConnection (balance lock)
              ├─ Debit balance → InternalSourceLedger (DEBIT_ORDER)
              ├─ Creates InternalSourceOrder { status: PENDING }
              ├─ Creates InternalSourceOrderEvent (order_created)
              │
              └─ fulfillInternalSourceOrder()
                    → PRO's InternalSourceService delivers the account
                    → InternalSourceOrder { status: FULFILLED | FAILED }
                    → Order.internalSourceOrderId linked back
```

Balance changes always go through `InternalSourceLedger` — never a direct column update.

---

## Warranty Flow

```
Order status = DELIVERED
      │
      ├─ snapshotWarrantyForDeliveredOrder()
      │     Infers policy from SourceProduct metadata:
      │       KBH   → no warranty, warrantyExpiresAt = null
      │       BH24H → +24 hours
      │       BH1M  → +1 month
      │       BH6M  → +6 months
      │       BH12M → +12 months
      │     Saves: warrantyPolicySnapshot, warrantyStartedAt, warrantyExpiresAt
      │
      └─ Customer taps [🛡️ Bảo hành] (Telegram button on delivered message)
            │
            ├─ Bot: ask for order code  (or pre-filled via warranty_claim:{code} callback)
            ├─ checkTelegramWarrantyEligibility()
            │     validates: exists, DELIVERED, no open claim, not KBH, not expired
            ├─ Bot: ask for issue description
            └─ submitTelegramWarrantyClaim()
                  │
                  ├─ warrantyClaimCount++ (inside transaction)
                  ├─ WarrantyClaim created
                  │
                  └─ decideClaimRoute()
                        │
                        ├─ MANUAL delivery mode
                        │     → status: PENDING_MANUAL
                        │     → notify seller, return support contacts to customer
                        │
                        ├─ claimCount > 2
                        │     → status: PENDING_REVIEW
                        │     → notify seller
                        │
                        ├─ AUTO_STOCK mode + stock available
                        │     → status: AUTO_RESOLVED
                        │     → deduct stock entry, deliver to customer
                        │
                        ├─ AUTO_STOCK mode + no stock
                        │     → status: PENDING_STOCK
                        │     → notify seller
                        │
                        ├─ AUTO_API mode + provider success
                        │     → status: AUTO_RESOLVED
                        │     → deliver replacement account text
                        │
                        └─ AUTO_API mode + provider failed / out of stock
                              → status: PENDING_STOCK or PENDING_REVIEW
                              → notify seller

Seller resolves via dashboard:
  PUT /warranty/claims/:id/resolve   → RESOLVED_MANUAL
  POST /warranty/claims/:id/reject   → REJECTED
```

---

## Storefront Modes

`Shop.storefrontMode` controls which customer-facing surfaces are active:

| Mode             | Telegram bot | Web storefront |
|------------------|:------------:|:--------------:|
| `TELEGRAM_ONLY`  | ✓            | ✗              |
| `HYBRID`         | ✓            | ✓              |
| `WEB_ONLY`       | ✗            | ✓              |

Web storefront configuration lives in `Shop.storefrontConfigJson` (typed in
`apps/api/src/storefront/storefront-config.types.ts`). The `StorefrontService`
is the single entry point for all storefront-mode-aware routing decisions — neither
bot handlers nor source-core services should read `storefrontMode` directly.

---

## Key Invariants

- Balance debits (seller wallet, customer wallet, internal source) always use a
  DB transaction that records `balanceBefore` and `balanceAfter` in the ledger table.
- `warrantyClaimCount` on `Order` is incremented inside the same transaction that
  inserts the `WarrantyClaim` row — never updated separately.
- `Order.sourceProviderKindSnapshot` records whether fulfillment used EXTERNAL or
  INTERNAL at time of purchase — immutable after delivery.
- Encrypted secrets always use the suffix `Encrypted` and are decrypted only at
  the point of use, never stored in-memory across requests.
