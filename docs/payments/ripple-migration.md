# Ripple Payments Migration

Verified contract for `iommarket` after Ripple's 15 Aug 2026 confirmation.

## Integration model

- Four fixed-price payment links identify the product via `link_code`.
- Confirmation is webhook-only. Ripple ignores arbitrary query parameters and does not honour `success_url` / `cancel_url`.
- A future `reference` query parameter will be echoed as `merchant_reference` on the **initial** payment only.
- Refunds and cancellations stay portal-managed. Ripple has no refund API and does not retry webhooks.

## Payment links

| Product | Code | Amount |
| --- | --- | --- |
| Private listing | `74A7510E33E94821` | £4.99 |
| Featured upgrade | `1BB714D5DBC446B6` | £5.00 |
| Dealer Starter monthly | `8181FAC1359E413E` | £29.99 |
| Dealer Pro monthly | `C5D44F6F18094B94` | £49.99 |

URLs: `https://portal.startyourripple.co.uk/card/codelabplatfdcf3a8/pay/{code}`

## Environment

- `RIPPLE_CLIENT_ID=codelabplatfdcf3a8`
- `RIPPLE_WEBHOOK_SECRET`
- `RIPPLE_REFERENCE_SECRET` (separate 256-bit secret)
- `RIPPLE_LIVE_CHECKOUT_ENABLED` (`1` only after underwriting and reference support)
- The four `RIPPLE_*_URL` values above
- `RIPPLE_DASHBOARD_URL`

Disabling checkout must never disable webhook ingestion or the retry cron.

## Webhooks

Destination: `/api/webhooks/ripple` or `/api/webhooks/payments`.

Signature: header `X-Ripple-Signature`, 64-character lowercase hex HMAC-SHA256 of the exact raw body. No `sha256=` prefix, no timestamp, not Standard Webhooks.

Envelope: `{ event, client_id, timestamp, data }`.

Events:

- `payment.received` - initial one-off or initial recurring signup
- `payment.success` - subsequent monthly collection
- `payment.failed`
- `subscription.created` - associate only, never grant access
- `subscription.paused` / `subscription.cancelled` / `subscription.resumed`

Amounts are decimal pounds. `payment_reference` is the only payment id. Renewals and lifecycle events use `customer_email` + `package` and have no `link_code`.

## Local processing rules

- Persist a minimized inbox row before applying business effects. Exact body-hash duplicates are no-ops, and a `PROCESSING` claim prevents concurrent workers from applying the same row.
- Listing and featured fulfillment require a valid signed `merchant_reference`.
- Dealer email fallback is allowed only when no reference is present and exactly one active dealer matches.
- Unknown `link_code` / `package` values are quarantined and never default to Starter.
- Paid entitlement requires `status=ACTIVE` and `currentPeriodEnd > now`.
- Failed inbox rows and stale `PENDING` rows are retried by `/api/cron/ripple-webhook-retry`. Disabling checkout never disables this cron.
- Reconcile daily against the Ripple portal because delivery is best-effort.

Use [`docs/production-rollout-checklist.md`](../production-rollout-checklist.md)
for migrate-before-code ordering, disabled-first deployment, live probes,
acceptance payments, refunds, and rollback.

## Manual refunds

Refund and cancel in the Ripple portal, then update local records from admin or the next lifecycle webhook. There is no verified refund event.
