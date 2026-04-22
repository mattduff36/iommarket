# Ripple Payments Migration

This document records the implemented migration shape for replacing Stripe with Ripple in `iommarket`.

## Integration Model

The app now treats Ripple as the active payment provider and uses a hybrid model:

- `iommarket` remains the source of truth for listing status, featured upgrades, dealer subscription gating, and local reporting.
- Ripple is assumed to provide the hosted payment experience and signed webhook delivery.
- Refunds and subscription cancellation are treated as portal-managed operations unless Ripple later exposes stable APIs for them.

## Current UX Decision

To keep the existing site structure unchanged with the least technical risk, the implementation defaults to **Ripple-hosted checkout** instead of trying to embed an unverified script/widget flow.

Current flow choices:

- Private listing payment: hosted Ripple payment URL
- Optional support payment: hosted Ripple payment URL
- Featured upgrade: hosted Ripple payment URL
- Dealer starter/pro subscription: hosted Ripple subscription URL

Embed remains a future option if Ripple provides a production-ready script and a stable redirect/webhook contract.

## Required Environment Variables

The new provider boundary expects these values:

- `RIPPLE_LISTING_PAYMENT_URL`
- `RIPPLE_LISTING_SUPPORT_URL`
- `RIPPLE_FEATURED_PAYMENT_URL`
- `RIPPLE_DEALER_STARTER_URL`
- `RIPPLE_DEALER_PRO_URL`
- `RIPPLE_DEALER_STARTER_PLAN_ID`
- `RIPPLE_DEALER_PRO_PLAN_ID`
- `RIPPLE_WEBHOOK_SECRET`
- `RIPPLE_DASHBOARD_URL` (recommended)
- `RIPPLE_EMBED_SCRIPT_URL` (optional, only if embed is later adopted)

## Public Demo Values Found

The public demo does not expose a reusable live API key or webhook secret, but the raw HTML does expose some non-secret demo values that are useful for redirect smoke tests:

- `CLIENT_ID=demo-gym`
- demo dashboard URL: `https://portal.startyourripple.co.uk/portal/demo-gym/card-portal`
- demo subscribe URL: `https://portal.startyourripple.co.uk/card/demo-gym/subscribe`
- demo pay-any URL: `https://portal.startyourripple.co.uk/card/demo-gym/pay-any`
- demo embed widget URL: `https://portal.startyourripple.co.uk/card/demo-gym/embed-widget`
- local-only demo starter plan ID fallback: `ripple_demo_gym_starter_monthly`
- local-only demo pro plan ID fallback: `ripple_demo_gym_pro_monthly`

The app now uses these public demo URLs as safe fallbacks for hosted redirect testing when the corresponding `RIPPLE_*_URL` env vars are not set.

What the demo did **not** expose publicly:

- a real `RIPPLE_WEBHOOK_SECRET`
- a real integration API key
- starter/pro plan IDs for production use
- checkout/package IDs for direct deep-linking to specific subscription packages

## Webhook Endpoint

Configure Ripple to send webhooks to:

- `/api/webhooks/payments`

The handler supports two verification styles:

- `standardwebhooks` headers (`webhook-id`, `webhook-timestamp`, `webhook-signature`)
- HMAC SHA-256 signatures via `ripple-signature`, `x-ripple-signature`, or `x-signature`

## Event Mapping

The payment bridge normalizes provider payloads into local outcomes:

### One-off payments

- `payment.succeeded` + `metadata.checkoutType=listing_payment`
  - create/update local `Payment`
  - transition eligible listing from `DRAFT` or `EXPIRED` to `PENDING`

- `payment.succeeded` + `metadata.checkoutType=listing_support`
  - create/update local `Payment` as `SUPPORT`

- `payment.succeeded` + `metadata.checkoutType=featured_upgrade`
  - create/update local `Payment`
  - set `Listing.featured = true`

- `payment.failed`
  - create/update local `Payment` with `FAILED`

- `payment.refunded`
  - mark matching local `Payment` as `REFUNDED`

### Dealer subscriptions

- `subscription.created`
  - upsert local `Subscription`
  - set dealer tier from webhook metadata or provider plan ID
  - ensure linked user role is `DEALER`

- `subscription.updated`
  - sync local status and period end
  - keep dealer tier aligned with plan mapping

- `subscription.cancelled`
  - mark local `Subscription` as `CANCELLED`

## Provider Metadata Expectations

The webhook bridge works best when Ripple includes these metadata fields in the event payload or merchant reference context:

- `checkoutType`
- `listingId`
- `dealerId`
- `tier`
- `merchantReference`

If Ripple cannot emit these values directly, the live setup should add them via Ripple custom fields, portal configuration, or an intermediary integration layer.

## Hosted URL Strategy

When `iommarket` creates a checkout URL, it appends context query parameters that Ripple may choose to consume or echo:

- `merchant_reference`
- `checkout_type`
- `listing_id`
- `dealer_id`
- `tier`
- `amount_pence`
- `email`
- `success_url`
- `cancel_url`

These parameters are intended to make the integration forward-compatible with Ripple’s onboarding guidance and to simplify debugging during rollout.

## Admin Operations

The admin UI now assumes:

- local status visibility stays in `iommarket`
- refunds are handled in Ripple’s portal
- subscription cancellation is handled in Ripple’s portal

If Ripple later exposes safe APIs for these actions, `lib/payments/provider.ts` is the integration point to extend.

## Data Model Strategy

The Prisma schema now preserves Stripe history while enabling Ripple cutover:

- `Payment.paymentProvider`
- `Payment.providerPaymentId`
- `Payment.providerReference`
- `Subscription.paymentProvider`
- `Subscription.providerSubscriptionId`
- `Subscription.providerPlanId`

Legacy Stripe columns remain in place as nullable fields for historical lookups and gradual backfill.

## Live Cutover Checklist

1. Export all active Stripe dealer subscriptions, renewal dates, and customer contact details.
2. Export historical Stripe payments needed for support and reporting.
3. Backfill neutral provider fields for all existing Stripe rows.
4. Create Ripple hosted links/pages for:
   - private listing fee
   - optional support payment
   - featured upgrade
   - dealer starter subscription
   - dealer pro subscription
5. Configure Ripple plan IDs to match:
   - `RIPPLE_DEALER_STARTER_PLAN_ID`
   - `RIPPLE_DEALER_PRO_PLAN_ID`
6. Configure Ripple webhook delivery to `/api/webhooks/payments`.
7. Verify signed webhook delivery in a non-production environment.
8. Reconcile a test listing payment, featured upgrade, and dealer subscription end to end.
9. Freeze Stripe subscription changes during the final migration window.
10. Recreate active subscriptions in Ripple with preserved dealer tier intent and next billing dates.
11. Run post-cutover reconciliation:
   - every active dealer has one active local subscription
   - provider IDs are stored locally
   - listing payments still move listings to `PENDING`
   - featured payments still mark listings as featured
12. Remove remaining Stripe credentials and operational access once the reconciliation window closes.

## Residual Risk

The current implementation is production-oriented but still depends on Ripple account-specific onboarding details:

- exact hosted URL formats
- exact webhook payload shape
- whether merchant context is echoed back automatically
- whether refunds/cancellations ever become API-managed

Those are now isolated to provider configuration and the webhook normalization layer instead of being spread across the app.
