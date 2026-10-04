# Ripple staging payments

Production and preview use separate databases. Preview shows normal prices,
but all new real-money hosted payments are disabled, including the retired £1 weekly and
£0.50 featured offers. The server enforces this for stale browser tabs and direct
checkout actions too. Existing dealer access and free listing submission remain
available. Production never grants test entitlements.

New preview purchases use the isolated [FlowPay sample checkout](preview-payment-simulator.md).
This does not replace the genuine weekly renewal test described here.

The existing £1 weekly subscription remains active for the renewal test. Product
recognition is separate from checkout availability: retain the test URLs, relay
secret, webhook receiver, and weekly billing-period logic.

## Configuration

- `RIPPLE_TEST_SUBSCRIPTION_URL`: dedicated Ripple link, £1 recurring weekly.
  Preview grants Starter access for seven days per successful charge.
- `RIPPLE_TEST_FEATURED_URL`: separate dedicated Ripple link, £0.50 one-off.
- Configure both link URLs in production for routing and on the preview branch
  for receipt recognition and fulfillment. Neither may reuse a normal product code.
- `RIPPLE_STAGING_RELAY_SECRET`: matching random secret of at least 32 characters
  on production and preview. Keep server-only.
- `NEXT_PUBLIC_APP_URL=https://itrader.dev` on the staging deployment.
- If Vercel protects the custom preview domain, production needs a server-only
  `VERCEL_AUTOMATION_BYPASS_SECRET`. Never expose it in a browser return URL.

Ripple's webhook remains `https://itrader.im/api/webhooks/ripple`. Production
verifies and stores events, and forwards only dedicated test-link events to
`https://itrader.dev/api/webhooks/ripple-staging`. The relay signs the
minimized payload with a fresh timestamp; the original body hash is retained for
deduplication. Production's existing retry cron retries failed delivery and
subscription processing. An unmatched featured receipt is acknowledged once
durably stored for authenticated browser reconciliation.

Cashflows account return URLs remain the production `/pay/success`, `/pay/failed`
and `/pay/cancelled` pages. Staging checkout first visits a signed production
handoff, which sets a host-only cookie on `itrader.im` and then continues to
Ripple. That cookie sends the browser back to the fixed `https://itrader.dev`
return page. It is not shared on `.itrader.im` and grants no account or payment access;
the actual checkout context is signed, host-only, and checked against the logged-in
user and verified email. `paymentjobref` locates a verified receipt, not proof of
payment by itself.

All real payment links are blocked from new preview checkout. Future
staging products require separate links and explicit configuration; do not fan
out all webhooks to both databases or match environments by email.

## Remaining live acceptance check

1. One week after signup, verify the actual renewal receipt, a second distinct
   charge, and the new seven-day period without a browser being present.
2. Cancel the provider subscription after testing if further charges are unwanted,
   only with the account owner's approval.
   Refunding a charge is not a substitute for cancelling recurring billing.

The live renewal is not proven by simulated callbacks. Keep both dedicated URLs
configured through the renewal test. Callbacks missing a recognizable product
code fail closed for investigation; do not infer a test product from a vague name.
