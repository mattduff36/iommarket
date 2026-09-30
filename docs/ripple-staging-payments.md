# Ripple staging payments

Production and preview use the same code and separate databases. Test products are
available only on Vercel Preview (or local development with
`RIPPLE_ENABLE_LOCAL_TEST_PLANS=1`). Production never grants test entitlements.

## Configuration

- `RIPPLE_TEST_SUBSCRIPTION_URL`: dedicated Ripple link, £1 recurring weekly.
  Preview grants Starter access for seven days per successful charge.
- `RIPPLE_TEST_FEATURED_URL`: separate dedicated Ripple link, £0.50 one-off.
- Configure both link URLs in production for routing and on the preview branch
  for checkout and fulfillment. Neither may reuse a normal product code.
- `RIPPLE_STAGING_RELAY_SECRET`: matching random secret of at least 32 characters
  on production and preview. Keep server-only.
- `NEXT_PUBLIC_APP_URL=https://preview.itrader.im` on the preview branch. Start
  staging checkouts on this domain so their host-only session remains available.
- If Vercel protects the custom preview domain, production needs a server-only
  `VERCEL_AUTOMATION_BYPASS_SECRET`. Never expose it in a browser return URL.

Ripple's webhook remains `https://itrader.im/api/webhooks/ripple`. Production
verifies and stores events, and forwards only dedicated test-link events to
`https://preview.itrader.im/api/webhooks/ripple-staging`. The relay signs the
minimized payload with a fresh timestamp; the original body hash is retained for
deduplication. Production's existing retry cron retries failed delivery and
subscription processing. An unmatched featured receipt is acknowledged once
durably stored for authenticated browser reconciliation.

Cashflows account return URLs remain the production `/pay/success`, `/pay/failed`
and `/pay/cancelled` pages. A short-lived routing cookie sends preview checkouts
back to the fixed preview domain. This marker grants no account or payment access;
the actual checkout context is signed, host-only, and checked against the logged-in
user and verified email. `paymentjobref` locates a verified receipt, not proof of
payment by itself.

Normal production payment links are blocked from preview checkout. Additional
staging products require separate links and explicit configuration; do not fan
out all webhooks to both databases or match environments by email.

## Live acceptance checks

1. On preview, use a dealer account without an existing entitlement and open
   `/dealer/subscribe?plan=weekly-test`. Confirm the page clearly shows £1/week.
2. Pay once using the account's real email. Check automatic return confirmation,
   one subscription charge, Starter access, and a period end seven days later.
3. Refresh the return page and retry the same webhook: no duplicate charge or
   extension should occur. Check production has no test subscription entitlement.
4. Upgrade an eligible live preview listing using the labelled £0.50 test button.
   Verify the exact listing is featured and the payment is recorded once.
5. One week after signup, verify the actual renewal receipt, a second distinct
   charge, and the new seven-day period without a browser being present.
6. Cancel the provider subscription after testing if further charges are unwanted.
   Refunding a charge is not a substitute for cancelling recurring billing.

The live renewal is not proven by simulated callbacks. Keep both dedicated URLs
configured through the renewal test. Callbacks missing a recognizable product
code fail closed for investigation; do not infer a test product from a vague name.
