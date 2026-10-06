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

## Ripple details-page bypass

Production checkout appends the payer's name and account email to every hosted
Ripple payment link. The name is the dealer business name when the account has
a dealer profile, otherwise the account display name. `URLSearchParams` encodes
the values, and the signed reference stays intact. The link stays on Ripple.
Missing or unusable details are omitted, and Ripple then shows its name and
email page. Ripple shows that same page when the skip tickbox is off for the
link. This does not open Cashflows directly.

`RIPPLE_SKIP_DETAILS_ENABLED=0` turns the query params off in production.
Preview and local omit them unless that server-only variable is `1`. A new
hosted payment uses the same builder, so it sends the same details without a
separate change. Ripple still has to tick the skip option on each new link.

## Deployment and verification

The additive SampleCheckout migration is part of the shared schema. Apply it to
preview before enabling the new deployment; apply it through the normal production
migration process when merging this code. Production never queries the simulator
table through its disabled entry points. Do not modify environment files in order
to change branches. Keep simulator and live renewal tests in the release checks.

Verify approval, decline then retry, cancellation, expiry, duplicate requests,
ownership checks, production rejection, and unchanged real weekly renewal state.
