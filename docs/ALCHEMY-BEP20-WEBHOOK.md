# Alchemy BEP20 webhook

The platform uses one Alchemy Address Activity webhook for every shop receiving
USDT on BNB Smart Chain. The webhook is the primary confirmation path; the
existing BSC RPC scanner remains the reconciliation fallback.

## One-time Alchemy setup

1. In Alchemy Notify, create an **Address Activity** webhook.
2. Select **BNB Chain Mainnet**.
3. Set the destination to:

   ```text
   ${APP_PUBLIC_URL}/api/v1/webhooks/alchemy/bep20
   ```

4. Copy the Notify Auth Token, webhook ID, and webhook signing key.
5. Configure the API environment:

   ```env
   ALCHEMY_NOTIFY_AUTH_TOKEN=...
   ALCHEMY_BEP20_WEBHOOK_ID=wh_...
   ALCHEMY_BEP20_SIGNING_KEY=whsec_...
   BSC_WEBHOOK_MIN_CONFIRMATIONS=1
   ```

6. Redeploy/restart the API.

At startup, the API adds every enabled shop BEP20 address to the shared
webhook. Saving a shop payment configuration also performs an idempotent
Alchemy address sync, so sellers do not manage Alchemy credentials.

## Security and matching

The endpoint:

- verifies `X-Alchemy-Signature` using HMAC-SHA256 over the exact raw body;
- requires the configured webhook ID and BNB mainnet activity;
- fetches the transaction receipt independently over BSC RPC;
- requires a successful transaction, the official USDT contract, the expected
  destination address, and the configured confirmation count;
- matches the globally unique two-decimal USDT invoice amount;
- rejects ambiguous matches and reused transaction hashes;
- delegates completion to the existing idempotent order/top-up/deposit flow.

## Fallback

Keep the worker running. It scans confirmed USDT transfer logs every 30 seconds
and reconciles events missed by Alchemy. `BSC_MIN_CONFIRMATIONS` controls the
scanner finality threshold independently from the webhook threshold.
