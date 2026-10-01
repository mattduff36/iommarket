# Preview sample payments

The same source runs on preview and production. New preview purchases use a
standalone FlowPay sample checkout in another tab. FlowPay is a fictional checkout
label, not an external payment service. No card information or money is processed.

## Environment selection

`isSampleCheckoutEnabled` requires both `VERCEL_ENV=preview` and the actual database
connection selected by `lib/db` to identify the isolated preview Supabase project
`syneonzucehwlghqmfbg`. Production, missing configuration and a production database
fail closed. If the preview database is intentionally replaced, update this guard
and its tests as part of the reviewed migration. Never infer payment mode from a
browser hostname, query parameter or client-supplied flag.

Live preview Ripple checkout remains disabled. The existing £1 weekly subscription,
its configured link URLs, production-to-preview signed relay and renewal handler
remain active. Do not remove those settings while the live renewal is being tested.

## Checkout behaviour

- A server-created, authenticated-owner checkout stores product, amount and target.
- The two sample cards submit only `approve` or `decline`; no PAN/CVV is collected.
- Approval records a DEV payment and applies listing moderation, featured status
  or a calendar-month dealer entitlement. Normal validation still applies.
- A decline records a failed sample attempt and stays on checkout with Retry and
  Cancel. Three attempts per checkout is our explicit simulation policy; it is
  not a claim about the merchant's configured Cashflows retry limit.
- Checkout expires after 30 minutes. Refreshes and duplicate submissions cannot
  change the result of an already-recorded attempt. A row lock serializes changes.
- Sample subscription signup is blocked for accounts with active real billing,
  including the existing weekly test account. Use another preview account.
- Sample subscriptions do not initiate real recurring billing. Their access ends
  at the stored period end; live recurring billing is tested separately via Ripple.
- Simulated records use `DEV`, `sim_` references and the SAMPLE PAYMENT admin label.
  Real Ripple receipt matching excludes these records. No simulated event is sent
  to Ripple, Cashflows, the production webhook or the staging relay. Sample listing
  fulfillment does not dispatch external notification emails.
- Original tabs refresh server-rendered content automatically. Same-origin storage
  events only request a server refresh; browser messages never establish payment.

## Deferred Ripple details-page bypass

`RIPPLE_SKIP_DETAILS_ENABLED` defaults to off (unset or anything other than `1`).
Once Ripple enables the portal option and it is checked on the intended links,
set this **server-only** variable to `1` in the desired Vercel environment and
redeploy. Valid account name/email are appended using URLSearchParams while the
signed reference remains intact. Missing/invalid details retain Ripple's form.
This forwards through Ripple; it does not introduce a direct Cashflows API.

## Deployment and verification

The additive SampleCheckout migration is part of the shared schema. Apply it to
preview before enabling the new deployment; apply it through the normal production
migration process when merging this code. Production never queries the simulator
table through its disabled entry points. Do not modify environment files in order
to change branches. Keep simulator and live renewal tests in the release checks.

Verify approval, decline then retry, cancellation, expiry, duplicate requests,
ownership checks, production rejection, and unchanged real weekly renewal state.
