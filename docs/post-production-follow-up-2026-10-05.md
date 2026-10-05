# Post-production follow-up — 5 October 2026

Deferred items only. None of these blocked the staging-to-production release.

## FlowPay admin refund controls

Normal `paymentProvider = DEV` FlowPay subscriptions can display the Ripple-oriented **Record portal refund** control.

`adminRefundSubscriptionPayment()` accepts that subscription because FlowPay stores a `sim_...` provider subscription ID. `sim_starter` and `sim_pro` are not Ripple products. The Ripple refund coverage path treats them as an unknown product and can cancel local sample coverage incorrectly.

Do not implement either option as part of the production release:

1. Hide or disable Ripple refund and portal controls for `DEV` records.
2. Design a separate FlowPay post-success refund simulator.

Succeeded one-off `DEV` payments can also display misleading **Manage in Ripple** wording.

## Ripple in-app refund capability

`supportsInAppRefunds` stays false. The claim/provider crash-concurrency prerequisite is still unresolved. In-app provider refunds remain disabled, so this does not block release.

## Local typecheck helper

The gitignored file `tmp/preview-deployment-target.ts` has an existing `NODE_ENV` / `ProcessEnv` mismatch. A whole-workspace typecheck can exit non-zero because of it. The file is not shipped and is not a production blocker.

## Ripple live webhook delivery / correlation follow-up

Observed on 5 October 2026. Hedy Quirk's real £5 Featured payment is confirmed as PAID in Ripple and has now been manually reconciled successfully in iTrader.

Ripple webhook record for Hedy:

- Event ID: `839a1f91-52f6-4bc1-9663-15002fc87741`
- Event: `payment.received`
- Payment reference: `261021000420123404`
- Amount: £5
- Currency: GBP
- Email: `hedyquirk@mac.com`
- Link code: `1BB714D5DBC446B6`
- Description: `Featured listing upgrade`
- Ripple delivery state: `Attempts: 0`
- Response: `no response`

A read-only production DB investigation confirmed:

- no matching `PaymentWebhookInbox` row exists for Hedy
- iTrader therefore did not receive or reject this webhook
- Hedy's payment was recovered manually with `ADMIN_PROVIDER_ATTESTATION`
- provider claim and reconciliation were created correctly
- payment is now `SUCCEEDED`

The webhook payload also contains no `merchant_reference`. Current production payment processing deliberately requires the signed merchant reference for automatic one-off reconciliation. It must not fall back to identifying a listing from customer email alone.

A previous Ripple test webhook did reach production successfully with `Attempts: 1`, HTTP `200`, and body `{"received":true}`. That leaves two separate questions:

1. Why are current live Ripple webhook events remaining at `Attempts: 0` and never being POSTed to `https://itrader.im/api/webhooks/ripple`?
2. Why are live Featured-payment webhook payloads missing the signed `merchant_reference` supplied during checkout?

Ranulf Lucas has a local £5 Featured checkout/payment row in iTrader, but there is no corresponding payment record in Ripple at all. This is being investigated separately through manual testing and should not be treated as proven webhook loss yet.

Tomorrow's investigation should:

- reproduce a new Flow/Ripple payment manually
- watch Ripple webhook delivery attempts in real time
- inspect whether `merchant_reference` is preserved through Ripple/Cashflows and returned in the webhook
- compare successful older webhook payloads with current live payloads
- verify webhook endpoint/HMAC/configuration only if Ripple actually attempts delivery
- keep merchant-reference correlation as-is; do not add an email-based fallback
- determine whether this is a Ripple configuration/provider issue, a checkout-link configuration issue, or an application issue
- document findings before making any code change
